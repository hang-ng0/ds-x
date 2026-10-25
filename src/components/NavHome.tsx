import {Link} from "react-router";
import styled from 'styled-components';

const NavStyle = styled.nav`
    display: flex;
`;

const UlStyle = styled.ul`
    flex-direction: column;
    align-items: center;
    margin: 2%;
    list-style: none;
    
    border: 2px solid #A6B823;
    border-radius: 10px;
`;

const LinkStyle = styled(Link)`
    text-decoration: none;
    padding: 0.65rem 1rem;
    border-radius: 0.5rem;
    color: #2a7099;

    &:hover {
        background-color: rgba(0, 0, 0, 0.1);
    }
`

export default function NavHome(){
    return(
        <NavStyle>
            <UlStyle>
                <li>
                    <LinkStyle to = {'/'}>Home</LinkStyle>
                </li>
                <li>
                    <LinkStyle to={'/paint'}>Paint</LinkStyle>
                </li>
                <li>
                    <LinkStyle to={'/gallery'}>Gallery</LinkStyle>
                </li>
            </UlStyle>
        </NavStyle>
    )
}