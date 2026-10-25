import {Link} from "react-router";
import styled from 'styled-components';

const NavStyle = styled.nav`
    flex-shrink: 0;
`;

const UlStyle = styled.ul`
    display: flex;
    align-items: center;
    padding: 0;
    list-style: none;
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

export default function Nav(){
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