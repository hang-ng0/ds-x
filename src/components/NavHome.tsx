// creates the Nav buttons for the home screen
import {Link} from "react-router";
import styled from 'styled-components';

const NavWrapper = styled.div`
    top: 60%;
    left: 5%;
    position: relative;
    z-index: 10;
`;

const NavStyle = styled.nav`
    position: absolute;
    display: flex;
    flex-direction: column;

`;

const UlStyle = styled.ul`
    margin: 2%;
    list-style: none;
`;

const LiStyle = styled.li`
    border: 4px solid #d2e357;
    border-radius: 10px;
    transition: background-color 0.2s ease-in-out;
    text-align: center;
    margin: 6%;


    &:hover {
        background-color: #d2e357;
    }
`

const LinkStyle = styled(Link)`
    text-decoration: none;
    color: #105173;
    text-shadow: 1px 1px #072b40, -1px -1px #f8fbfd;
    font-size: calc(2px + 3.3vw);
`

export default function NavHome(){
    return(
        <NavWrapper>
            <NavStyle>
                <UlStyle>
                    <LiStyle>
                        <LinkStyle to = {'/'}>Home</LinkStyle>
                    </LiStyle>
                    <LiStyle>
                        <LinkStyle to={'/paint'}>Paint</LinkStyle>
                    </LiStyle>
                    <LiStyle>
                        <LinkStyle to={'/gallery'}>Gallery</LinkStyle>
                    </LiStyle>
                </UlStyle>
            </NavStyle>
        </NavWrapper>
    )
}