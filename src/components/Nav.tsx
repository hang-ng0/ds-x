import {Link} from "react-router";
import styled from 'styled-components';

const NavStyle = styled.nav`
    padding: 3%;
    background-color: cyan;
`;

const UlStyle = styled.ul`
    text-align: center;
`;

const LiStyle = styled.li`
    display: inline;
    list-style: none;
`;

const LinkStyle = styled(Link)`
    text-decoration: none;
    padding: 5%;
`

export default function Nav(){
    return(
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
    )
}